import { Voice, isNative } from "../native";
import { tasteHistory } from "./tasteGuard";
import { db } from "./db";
import { normalize } from "./FanUploadParser";
import { creditedArtists } from "../components/ArtistProfile";
import { songKey } from "./blendMixes";
import { pickDiscoveries, tasteProfile } from "./autoMixes";
import { continuationPicks } from "./continuation";
import { longForm, vibeFromCatalogue } from "./VoiceCommandRouter";
import type { HistoryEntry, QueueItem } from "./types";

/**
 * "Mix del momento": your own music for this time of day.
 *
 * 1. What you play at this hour: plays within ±2 h of now, on the same kind of day (weekday or
 *    weekend), in the last 60 days. Each play counts by how much of the song you heard and how recent
 *    it was; quick skips count against the song.
 * 2. About 55 % of the mix are those songs (a weighted draw, so the order changes every day; never a
 *    song started in the last 3 hours), 45 % discoveries near them: YouTube Music's radio after two of
 *    them and artists related to your top artists of the hour (continuation.ts), interleaved.
 * 3. Too little history at this hour (< 12 plays): the same hour on any day; then your overall
 *    favourites and saves with the moment's mood as a tie-breaker (on-device model); only as a last
 *    resort YouTube Music's playlists for the mood (vibeFromCatalogue).
 *
 * The result is kept 30 minutes for the current moment, so tapping the card is instant.
 */

export interface Moment {
  key: string;
  title: string;
  /** Generic line, used when MURMUR does not know your taste yet. */
  subtitle: string;
  /** The voice request of earlier versions (and the legacy fallback): «pon algo tranquilo para la noche». */
  request: string;
  /** The mood in the catalogue's words, for the mood tie-breaker and the catalogue fallback. */
  mood: string;
}

export function momentFor(hour: number, weekday: number): Moment {
  const weekend = weekday === 0 || weekday === 6;
  if (hour >= 5 && hour < 11)
    return { key: "morning", title: "Para empezar el día", subtitle: "Energía para arrancar", request: "pon algo animado para empezar el dia", mood: "animado para empezar el dia" };
  if (hour >= 11 && hour < 18)
    return weekend
      ? { key: "weekend", title: "Para el fin de semana", subtitle: "Buena vibra", request: "pon algo alegre para el fin de semana", mood: "alegre para el fin de semana" }
      : { key: "focus", title: "Para concentrarte", subtitle: "Sin distracciones", request: "pon algo para concentrarme", mood: "concentrarme" };
  if (hour >= 18 && hour < 23)
    return { key: "evening", title: "Para la noche", subtitle: "Para bajar el ritmo", request: "pon algo tranquilo para la noche", mood: "tranquilo para la noche" };
  return { key: "late", title: "Para desvelarte", subtitle: "Suave, de madrugada", request: "pon algo relajado para dormir", mood: "relajado para dormir" };
}

/** Where the mix's songs come from, from most to least personal. */
export type MixBasis = "hour" | "hour-any-day" | "taste" | "catalogue";

export interface MomentMixResult {
  title: string;
  /** Why it is yours: «Con Caifanes, Enjambre y lo que sueles oír a esta hora». */
  subtitle: string;
  tracks: QueueItem[];
  /** A longer explanation, for a notice when it starts playing. */
  reason: string;
  momentKey: string;
  basis: MixBasis;
  /** The artists named in the subtitle (all of them are in the mix). */
  artists: string[];
  /** When it was built (ms). */
  at: number;
  /** How long it stays valid (ms): shorter when discoveries could not be fetched. */
  ttl: number;
}

export interface MomentMixOptions {
  /** Rebuild even when a fresh mix of this moment is cached. */
  force?: boolean;
  /** Songs in the mix (default 25). */
  size?: number;
  random?: () => number;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
export const MOMENT_FRESH_MS = 30 * 60_000;
const SHORT_FRESH_MS = 5 * 60_000;
/** Fewer plays than this in the hour window: not enough to say "what you play at this hour". */
export const MIN_WINDOW_PLAYS = 12;
/** A mix shorter than this is completed from the catalogue. */
const MIN_TRACKS = 10;
const YOURS_SHARE = 0.55;
const CACHE_KEY = "moment:mix:v1";

const lead = (artist: string) => creditedArtists(artist)[0] ?? artist;
const artistKey = (artist: string) => normalize(lead(artist));

// ── Pure parts ──────────────────────────────────────────────────────────────────────────────────

export type DayClass = "weekday" | "weekend";
export const dayClass = (date: Date): DayClass => (date.getDay() === 0 || date.getDay() === 6 ? "weekend" : "weekday");

/** Hours between two times of day, across midnight (23:30 ↔ 00:30 = 1). */
export function hourDistance(a: Date, b: Date) {
  const h = (d: Date) => d.getHours() + d.getMinutes() / 60;
  const diff = Math.abs(h(a) - h(b));
  return Math.min(diff, 24 - diff);
}

export interface WindowOptions {
  hours?: number;
  days?: number;
  sameDayClass?: boolean;
}

/** Plays near this time of day: within ±`hours`, in the last `days`, on the same kind of day by default. */
export function hourWindow(history: HistoryEntry[], now: Date, { hours = 2, days = 60, sameDayClass = true }: WindowOptions = {}) {
  const end = now.getTime();
  const since = end - days * DAY;
  const kind = dayClass(now);
  return history.filter((entry) => {
    if (!Number.isFinite(entry.at) || entry.at < since || entry.at > end) return false;
    const at = new Date(entry.at);
    return hourDistance(at, now) <= hours && (!sameDayClass || dayClass(at) === kind);
  });
}

/** Plays that say "I listened": 30 s or more. */
export const countPlays = (entries: HistoryEntry[]) =>
  entries.filter((e) => Number.isFinite(e.seconds) && e.seconds >= 30).length;

/**
 * What one play says about a song: how much of it you heard (0.3–1), halved every 30 days, times how
 * close to this hour it was. A skip in the first 30 s counts against it; other short plays say nothing.
 */
export function playWeight(entry: HistoryEntry, duration: number | undefined, now: number, closeness = 1) {
  const recency = Math.pow(0.5, Math.max(0, now - entry.at) / (30 * DAY));
  if (!Number.isFinite(entry.seconds)) return 0;
  if (entry.skipped && entry.seconds < 30) return -recency * closeness;
  if (entry.seconds < 30) return 0;
  const completion = Math.min(1, entry.seconds / (duration && duration > 0 ? duration : 180));
  return (0.3 + 0.7 * completion) * recency * closeness;
}

export interface ScoredSong {
  /** The version you play most stands for the song. */
  track: QueueItem;
  /** songKey: other versions of the same song count together. */
  key: string;
  score: number;
  plays: number;
}

/** Sums the plays of each song (all its versions together). */
export function scoreSongs(entries: HistoryEntry[], byId: Map<string, QueueItem>, now: Date, closeness: (entry: HistoryEntry) => number = () => 1): ScoredSong[] {
  const songs = new Map<string, ScoredSong & { versions: Map<string, number> }>();
  for (const entry of entries) {
    const track = byId.get(entry.trackId);
    if (!track) continue;
    const key = songKey(track);
    const weight = playWeight(entry, track.duration, now.getTime(), closeness(entry));
    let song = songs.get(key);
    if (!song) songs.set(key, (song = { track, key, score: 0, plays: 0, versions: new Map() }));
    song.score += weight;
    if (weight > 0) song.plays++;
    const version = (song.versions.get(track.id) ?? 0) + weight;
    song.versions.set(track.id, version);
    if (song.track.id !== track.id && version > (song.versions.get(song.track.id) ?? 0)) song.track = track;
  }
  return [...songs.values()].map(({ versions: _versions, ...song }) => song);
}

/** Your overall favourites: everything you heard (recent counts more), saved songs, and the artists you love. */
export function tasteSongs(history: HistoryEntry[], library: QueueItem[], byId: Map<string, QueueItem>, now: Date, taste: Map<string, number>): ScoredSong[] {
  const songs = new Map(scoreSongs(history, byId, now).map((s) => [s.key, s]));
  for (const track of library) {
    if (!track.saved) continue;
    const key = songKey(track);
    const song = songs.get(key);
    if (song) song.score += 1.5;
    else songs.set(key, { track, key, score: 1.5, plays: 0 });
  }
  for (const song of songs.values()) song.score += 0.2 * Math.min(5, Math.max(0, taste.get(artistKey(song.track.artist)) ?? 0));
  return [...songs.values()];
}

/** Songs (by songKey) started in the last `hours`, whatever happened next. */
export function recentKeys(history: HistoryEntry[], byId: Map<string, QueueItem>, now: Date, hours = 3) {
  const since = now.getTime() - hours * HOUR;
  const keys = new Set<string>();
  for (const entry of history) {
    if (entry.at < since || entry.at > now.getTime()) continue;
    const track = byId.get(entry.trackId);
    if (track) keys.add(songKey(track));
  }
  return keys;
}

/** The artists that weigh most among these songs, as you see them written. */
export function topArtists(songs: ScoredSong[], count = 3) {
  const totals = new Map<string, { name: string; score: number; best: number }>();
  for (const song of songs) {
    if (song.score <= 0) continue;
    const key = artistKey(song.track.artist);
    if (!key) continue;
    const entry = totals.get(key) ?? { name: lead(song.track.artist), score: 0, best: -Infinity };
    entry.score += song.score;
    if (song.score > entry.best) { entry.best = song.score; entry.name = lead(song.track.artist); }
    totals.set(key, entry);
  }
  return [...totals.values()].sort((a, b) => b.score - a.score).slice(0, count).map((a) => a.name);
}

/**
 * Weighted order without repeats (Efraimidis–Spirakis): a song with twice the weight is twice as
 * likely to come first, so the favourites lead without the same order every day.
 */
export function weightedOrder<T>(items: { item: T; weight: number }[], random: () => number = Math.random): T[] {
  return items
    .filter((x) => x.weight > 0 && Number.isFinite(x.weight))
    .map((x) => ({ item: x.item, rank: Math.pow(Math.max(random(), 1e-12), 1 / x.weight) }))
    .sort((a, b) => b.rank - a.rank)
    .map((x) => x.item);
}

/**
 * Your songs for the mix: a weighted draw, the artists named in the subtitle always in, at most
 * `perArtist` songs each (relaxed only when there are too few artists to fill the mix).
 */
export function pickYours(songs: ScoredSong[], count: number, { artists = [] as string[], perArtist = 3, random = Math.random } = {}): QueueItem[] {
  const order = weightedOrder(songs.map((s) => ({ item: s, weight: s.score })), random);
  const chosen = new Set<ScoredSong>();
  const perCount = new Map<string, number>();
  const take = (song: ScoredSong) => {
    chosen.add(song);
    const key = artistKey(song.track.artist);
    perCount.set(key, (perCount.get(key) ?? 0) + 1);
  };
  for (const name of artists) {
    if (chosen.size >= count) break;
    const song = order.find((s) => !chosen.has(s) && artistKey(s.track.artist) === normalize(name));
    if (song) take(song);
  }
  for (const song of order) {
    if (chosen.size >= count) break;
    if (!chosen.has(song) && (perCount.get(artistKey(song.track.artist)) ?? 0) < perArtist) take(song);
  }
  for (const song of order) {
    if (chosen.size >= count) break;
    if (!chosen.has(song)) take(song);
  }
  return order.filter((s) => chosen.has(s)).map((s) => s.track);
}

/** Discoveries spread evenly between your songs, always starting with one of yours. */
export function interleave<T>(yours: T[], discoveries: T[]): T[] {
  const total = yours.length + discoveries.length;
  const out: T[] = [];
  let y = 0;
  let d = 0;
  for (let i = 0; i < total; i++) {
    const due = Math.floor(((i + 1) * discoveries.length) / total);
    if ((d < due && d < discoveries.length) || y >= yours.length) out.push(discoveries[d++]);
    else out.push(yours[y++]);
  }
  return out;
}

/**
 * Never more than `maxRun` songs by one artist in a row (whenever the songs allow it). Two in a row
 * are avoided too when a different artist is among the next few songs, so the order barely changes;
 * an artist with most of the songs is placed early enough to still fit in runs of `maxRun`.
 */
export function spaceArtists<T extends Pick<QueueItem, "artist">>(tracks: T[], maxRun = 2, lookahead = 4): T[] {
  const rest = [...tracks];
  const out: T[] = [];
  while (rest.length) {
    const last = out.length ? artistKey(out[out.length - 1].artist) : "";
    let run = 0;
    for (let i = out.length - 1; i >= 0 && artistKey(out[i].artist) === last; i--) run++;
    const counts = new Map<string, number>();
    for (const t of rest) counts.set(artistKey(t.artist), (counts.get(artistKey(t.artist)) ?? 0) + 1);
    // An artist that would no longer fit if anyone else went first.
    const urgent = [...counts.entries()].find(([artist, count]) =>
      count > maxRun * (rest.length - count) && (artist !== last || run < maxRun))?.[0];
    let index = 0;
    if (urgent !== undefined) index = rest.findIndex((t) => artistKey(t.artist) === urgent);
    else if (run && artistKey(rest[0].artist) === last) {
      const near = rest.findIndex((t, j) => j <= lookahead && artistKey(t.artist) !== last);
      if (near >= 0) index = near;
      else if (run >= maxRun) index = Math.max(0, rest.findIndex((t) => artistKey(t.artist) !== last));
    }
    out.push(rest.splice(index, 1)[0]);
  }
  return out;
}

/**
 * Candidates from the radio and related-artist lists, best first: earlier in its list is closer,
 * found by both lists is closer still, a song you already know is a weaker discovery.
 */
export function rankDiscoveries(
  lists: QueueItem[][],
  { exclude, known, disliked, random = Math.random }: { exclude: Set<string>; known: Set<string>; disliked: Set<string>; random?: () => number },
) {
  const best = new Map<string, { track: QueueItem; score: number }>();
  for (const list of lists)
    list.forEach((track, index) => {
      const key = songKey(track);
      if (exclude.has(key) || disliked.has(artistKey(track.artist)) || longForm(track)) return;
      const score = 1 - index / Math.max(1, list.length) - (known.has(key) ? 0.5 : 0) + random() * 0.1;
      const previous = best.get(key);
      best.set(key, previous ? { track: previous.track, score: Math.max(previous.score, score) + 0.2 } : { track, score });
    });
  return [...best.values()];
}

/** The mood tie-breaker: a song that fits the moment (0–1) moves up a little, never past a much-loved one. */
export function applyMood(songs: ScoredSong[], moodOf: (song: ScoredSong) => number | undefined) {
  return songs
    .map((song) => ({ ...song, score: song.score * (0.8 + 0.4 * Math.min(1, Math.max(0, moodOf(song) ?? 0.5))) }))
    .sort((a, b) => b.score - a.score);
}

const joinNames = (names: string[]) => {
  let shown = names.slice(0, 3);
  // Two lines at most on the card: a third artist only when the names are short.
  if (shown.length === 3 && shown.join(", ").length > 30) shown = shown.slice(0, 2);
  return shown.join(", ");
};

/** The line under the title, saying why the mix is yours. */
export function momentSubtitle(basis: MixBasis, artists: string[], moment: Pick<Moment, "subtitle">) {
  if (basis === "catalogue") return moment.subtitle + " · aún aprendo tus gustos";
  const names = joinNames(artists);
  if (basis === "taste") return names ? `Con ${names} y más de lo que te gusta` : "Más de lo que te gusta";
  return names ? `Con ${names} y lo que sueles oír a esta hora` : "Lo que sueles oír a esta hora";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const hourLabel = (hour: number) =>
  hour === 0 ? "hacia la medianoche" : hour === 12 ? "hacia el mediodía" : hour === 1 ? "hacia la 1 h" : `hacia las ${hour} h`;

/** A longer explanation of the mix, for a notice when it starts. */
export function momentReason(basis: MixBasis, counts: { yours: number; discoveries: number; filler?: number }, now: Date) {
  if (basis === "catalogue") return "Aún no conozco tus gustos a esta hora: una mezcla de YouTube Music para el momento.";
  const found = counts.discoveries ? ` y ${plural(counts.discoveries, "descubrimiento cercano", "descubrimientos cercanos")}` : "";
  const filler = counts.filler ? ", completado con YouTube Music" : "";
  if (basis === "taste")
    return `Aún escuchas poca música a esta hora: ${plural(counts.yours, "de tus favoritas", "de tus favoritas")}${found}${filler}.`;
  const when = basis === "hour" ? (dayClass(now) === "weekend" ? " los fines de semana" : " entre semana") : "";
  return `${plural(counts.yours, "canción que sueles", "canciones que sueles")} oír${when} ${hourLabel(now.getHours())}${found}${filler}.`;
}

export interface MomentProfile {
  moment: Moment;
  basis: MixBasis;
  /** Songs you could hear now (not started in the last 3 h, no disliked artist), best first. */
  songs: ScoredSong[];
  /** Top artists of those songs, for the subtitle. */
  artists: string[];
  /** Plays (≥ 30 s) behind the basis. */
  plays: number;
  /** Songs started in the last 3 hours. */
  recent: Set<string>;
  /** Every song of the window (or of the favourites), eligible or not. */
  pool: Set<string>;
  /** Songs you have heard for 30 s or more, or saved. */
  known: Set<string>;
  disliked: Set<string>;
}

/** Everything about this moment that needs only the phone's data: no network. */
export function momentProfile(
  allHistory: HistoryEntry[],
  library: QueueItem[],
  now: Date,
  { minPlays = MIN_WINDOW_PLAYS, hours = 2, days = 60, recentHours = 3 } = {},
): MomentProfile {
  const moment = momentFor(now.getHours(), now.getDay());
  const byId = new Map(library.map((t) => [t.id, t]));
  // Your moments come from your listening, not from tests or guests (see tasteGuard).
  const history = tasteHistory(allHistory, library);
  const taste = tasteProfile(allHistory, library, {});
  const disliked = new Set([...taste.entries()].filter(([, w]) => w <= -3).map(([a]) => a));
  const recent = recentKeys(allHistory, byId, now, recentHours);
  const closeness = (entry: HistoryEntry) => 1 - (0.4 * hourDistance(new Date(entry.at), now)) / hours;

  let basis: MixBasis = "hour";
  let entries = hourWindow(history, now, { hours, days, sameDayClass: true });
  if (countPlays(entries) < minPlays) {
    basis = "hour-any-day";
    entries = hourWindow(history, now, { hours, days, sameDayClass: false });
  }
  let plays = countPlays(entries);
  let all: ScoredSong[];
  if (plays >= minPlays) all = scoreSongs(entries, byId, now, closeness);
  else {
    basis = "taste";
    all = tasteSongs(history, library, byId, now, taste);
    plays = countPlays(history);
  }
  const songs = all
    .filter((s) => s.score > 0 && !recent.has(s.key) && !disliked.has(artistKey(s.track.artist)))
    .sort((a, b) => b.score - a.score);
  if (!songs.length) basis = "catalogue";
  const known = new Set<string>();
  for (const entry of history) {
    const track = byId.get(entry.trackId);
    if (track && entry.seconds >= 30) known.add(songKey(track));
  }
  for (const track of library) if (track.saved) known.add(songKey(track));
  return { moment, basis, songs, artists: topArtists(songs, 3), plays, recent, pool: new Set(all.map((s) => s.key)), known, disliked };
}

// ── Building, with the network and the cache ────────────────────────────────────────────────────

async function settle<T>(promise: Promise<T>): Promise<T | undefined> {
  try { return await promise; } catch { return undefined; }
}

const label = (track: QueueItem) => `${lead(track.artist)} — ${track.title}`;

/** The moment's mood ranks your favourites with the on-device sentence model, when it is installed. */
async function withMood(songs: ScoredSong[], mood: string) {
  if (!isNative || songs.length < 2) return songs;
  const top = songs.slice(0, 150);
  const ranked = await settle(Voice.rankTags({ query: "música " + mood, tags: top.map((s) => label(s.track)) }));
  const scores = new Map((ranked?.ranked ?? []).map((r) => [r.text, r.score]));
  if (!scores.size) return songs;
  return [...applyMood(top, (s) => scores.get(label(s.track))), ...songs.slice(150)];
}

/**
 * Your songs as a queue for continuation.ts, which looks up artists related to the first artists of
 * the last 12 songs: those 12 start with the best song of each `focus` artist.
 */
export function focusedQueue(songs: QueueItem[], yours: QueueItem[], focus: string[]) {
  const first = focus
    .map((name) => songs.find((t) => artistKey(t.artist) === normalize(name)))
    .filter((t): t is QueueItem => !!t);
  const ordered = [...new Set([...first, ...yours, ...songs])];
  return [...ordered.slice(12), ...ordered.slice(0, 12)];
}

/** Discoveries near your songs: YouTube Music's radio after two of them, and related artists (continuation.ts). */
async function discover(profile: MomentProfile, yours: QueueItem[], count: number, exclude: Set<string>, random: () => number) {
  if (!isNative || count <= 0 || !yours.length) return [];
  const seeds = yours.filter((t, i) => yours.findIndex((x) => artistKey(x.artist) === artistKey(t.artist)) === i).slice(0, 2);
  const ranked = topArtists(profile.songs, 6);
  const lists = await Promise.all(seeds.map((seed, i) => {
    const focus = i && ranked.length > 3 ? ranked.slice(3, 6) : ranked.slice(0, 3);
    const queue = focusedQueue(profile.songs.map((s) => s.track), yours, focus);
    return continuationPicks(queue, seed, Math.max(count, 10), async () => []).catch(() => [] as QueueItem[]);
  }));
  const scored = rankDiscoveries(lists, { exclude, known: profile.known, disliked: profile.disliked, random });
  return pickDiscoveries(scored, count, 2, exclude);
}

/** A mix song is a normal song of the list: not an "Aleatorio mágico" or continuation addition. */
function plain(track: QueueItem): QueueItem {
  const { smart: _smart, continuation: _continuation, userQueued: _userQueued, queueId: _queueId, ...rest } = track;
  return rest;
}

let memory: MomentMixResult | undefined;
const inflight = new Map<string, Promise<MomentMixResult>>();

const isFresh = (mix: MomentMixResult | undefined, now: Date): mix is MomentMixResult =>
  !!mix && mix.momentKey === momentFor(now.getHours(), now.getDay()).key &&
  now.getTime() >= mix.at && now.getTime() - mix.at < (mix.ttl || MOMENT_FRESH_MS);

/** The mix of this moment if it is already built and fresh (memory only, synchronous). */
export function peekMomentMix(now = new Date()) {
  return isFresh(memory, now) ? memory : undefined;
}

/** Forgets the cached mix (tests, or after clearing the history). */
export async function clearMomentMixCache() {
  memory = undefined;
  inflight.clear();
  await db.settings.delete(CACHE_KEY).catch(() => {});
}

async function cachedMix(now: Date) {
  let mix = peekMomentMix(now);
  if (!mix) {
    const stored = (await settle(db.settings.get(CACHE_KEY)))?.value as MomentMixResult | undefined;
    if (!isFresh(stored, now)) return;
    mix = memory = stored;
  }
  // Songs heard since it was built are dropped: a second tap goes on with the rest.
  const since = await settle(db.history.where("at").above(mix.at).toArray());
  const played = new Set((since ?? []).map((h) => h.trackId));
  const left = mix.tracks.filter((t) => !played.has(t.id));
  if (left.length < MIN_TRACKS) return;
  return left.length === mix.tracks.length ? mix : { ...mix, tracks: left };
}

async function build(now: Date, { size = 25, random = Math.random }: MomentMixOptions): Promise<MomentMixResult> {
  const [history, stored] = await Promise.all([db.history.toArray(), db.tracks.toArray()]);
  const library = stored.filter((t) => !t.deleted);
  const profile = momentProfile(history, library, now);
  const songs = profile.basis === "taste" ? await withMood(profile.songs, profile.moment.mood) : profile.songs;
  const yours = pickYours(songs, Math.round(size * YOURS_SHARE), { artists: profile.artists, random });
  const exclude = new Set([...profile.recent, ...profile.pool, ...yours.map(songKey), ...stored.filter((t) => t.deleted).map(songKey)]);
  const wanted = size - yours.length;
  const discoveries = await discover(profile, yours, wanted, exclude, random);
  let tracks = spaceArtists(interleave(yours, discoveries));
  let basis = profile.basis;
  let filler = 0;
  if (tracks.length < MIN_TRACKS) {
    // Last resort: the catalogue's playlists for the mood (ranked by the artists you know).
    const used = new Set([...tracks.map(songKey), ...profile.recent]);
    const vibe = (await settle(vibeFromCatalogue(profile.moment.mood)))?.tracks ?? [];
    const extra = vibe.filter((t) => !used.has(songKey(t)) && !profile.disliked.has(artistKey(t.artist))).slice(0, size - tracks.length);
    filler = extra.length;
    if (!tracks.length) basis = "catalogue";
    tracks = spaceArtists([...tracks, ...extra]);
  }
  const artists = basis === "catalogue" ? [] : profile.artists;
  const mix: MomentMixResult = {
    title: profile.moment.title,
    subtitle: momentSubtitle(basis, artists, profile.moment),
    reason: momentReason(basis, { yours: yours.length, discoveries: discoveries.length, filler }, now),
    tracks: tracks.map(plain),
    momentKey: profile.moment.key,
    basis,
    artists,
    at: now.getTime(),
    // Offline or nothing found nearby: try the discoveries again soon instead of for half an hour.
    ttl: isNative && wanted > 0 && yours.length && !discoveries.length ? SHORT_FRESH_MS : MOMENT_FRESH_MS,
  };
  if (mix.tracks.length) {
    memory = mix;
    await settle(db.settings.put({ key: CACHE_KEY, value: mix }));
  }
  return mix;
}

/**
 * The mix of the moment for `now`: from the cache when this moment's mix is fresh (instant, no
 * network), otherwise built (and cached for 30 minutes). Calls while it is being built share it.
 * Never rejects for network trouble: offline it returns your own songs, or an empty list.
 */
export async function buildMomentMix(now: Date = new Date(), opts: MomentMixOptions = {}): Promise<MomentMixResult> {
  const key = momentFor(now.getHours(), now.getDay()).key;
  if (!opts.force) {
    const cached = await cachedMix(now);
    if (cached) return cached;
  }
  let job = inflight.get(key);
  if (!job) {
    job = build(now, opts).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

/**
 * The card's text right away: the cached mix's, or worked out from the phone's history alone (no
 * network), so the subtitle appears before the mix is built.
 */
export async function momentMixPreview(now: Date = new Date()): Promise<Pick<MomentMixResult, "title" | "subtitle" | "momentKey" | "basis" | "artists">> {
  const cached = peekMomentMix(now) ?? (await cachedMix(now));
  if (cached) return cached;
  const [history, library] = await Promise.all([db.history.toArray(), db.tracks.toArray()]);
  const profile = momentProfile(history, library, now);
  const artists = profile.basis === "catalogue" ? [] : profile.artists;
  return { title: profile.moment.title, subtitle: momentSubtitle(profile.basis, artists, profile.moment), momentKey: profile.moment.key, basis: profile.basis, artists };
}
