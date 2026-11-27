import { db } from "./db";
import { Auth, isNative } from "../native";
import { magicPicks } from "./magicShuffle";
import { songKey } from "./blendMixes";
import { youtubeTwin } from "./spotifyBridge";
import { judgeHistory } from "./tasteGuard";
import { normalize } from "./FanUploadParser";
import { creditedArtists } from "../components/ArtistProfile";
import type { HistoryEntry, QueueItem } from "./types";
import type { Mood } from "./moods";

/** When this many songs or fewer remain after the current one, MURMUR adds more. */
export const CONTINUE_WHEN_LEFT = 2;
/** Songs added each time the queue is about to run out (and each time "aleatorio" asks for a new selection). */
export const CONTINUE_BATCH = 15;

const lead = (artist: string) => normalize(creditedArtists(artist)[0] ?? artist);
/** A JAM guest's song (not saved by the owner) never decides what MURMUR picks next. */
const fromGuest = (t?: QueueItem) => !!t?.jamGuest && !t.saved;

/* ---------- What was suggested lately: a new selection brings other songs ---------- */
const SUGGESTED_KEY = "murmur.radioSuggested";
const SUGGESTED_DAYS = 4;
function suggestedLately(now = Date.now()): Map<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SUGGESTED_KEY) || "{}") as Record<string, number>;
    return new Map(Object.entries(raw).filter(([, at]) => now - at < SUGGESTED_DAYS * 86_400_000));
  } catch { return new Map(); }
}
function rememberSuggested(tracks: QueueItem[], now = Date.now()) {
  try {
    const all = suggestedLately(now);
    for (const t of tracks) all.set(songKey(t), now);
    const kept = [...all.entries()].sort((a, b) => b[1] - a[1]).slice(0, 900);
    localStorage.setItem(SUGGESTED_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch { /* no storage (tests): nothing to remember */ }
}

/**
 * "Las que sueles escuchar después": songs the owner played (≥ 30 s, not skipped, not as a guest)
 * right after this song, or after a song by the same artist, with how many times.
 */
export function habitsAfter(seed: QueueItem, history: HistoryEntry[], library: Map<string, QueueItem>): { track: QueueItem; times: number }[] {
  const ordered = [...history].filter((e) => !e.guest).sort((a, b) => a.at - b.at);
  const artist = lead(seed.artist);
  const counts = new Map<string, { track: QueueItem; times: number }>();
  for (let i = 0; i < ordered.length - 1; i++) {
    const here = library.get(ordered[i].trackId);
    if (!here || ordered[i].skipped) continue;
    const same = here.id === seed.id || songKey(here) === songKey(seed);
    if (!same && lead(here.artist) !== artist) continue;
    const next = ordered[i + 1];
    if (next.skipped || next.seconds < 30 || next.at - ordered[i].at > 20 * 60_000) continue;
    const track = library.get(next.trackId);
    if (!track || track.deleted || songKey(track) === songKey(seed)) continue;
    const key = songKey(track);
    const weight = same ? 2 : 1;
    const seen = counts.get(key);
    counts.set(key, { track, times: (seen?.times ?? 0) + weight });
  }
  return [...counts.values()].sort((a, b) => b.times - a.times);
}

/** YouTube Music's radio after a song (with the owner's session it is their personal one: their taste). */
async function radio(seed: QueueItem | undefined): Promise<QueueItem[]> {
  if (!isNative || !seed?.videoId) return [];
  const result = await Auth.youtubeCollection({ id: "RDAMVM" + seed.videoId }).catch(() => undefined);
  return (result?.tracks ?? []).filter((t) => t.videoId !== seed.videoId);
}

/** A random pick of the list that still leans to its first songs (the closest to the seed). */
function sampleLeaning<T>(list: T[], count: number): T[] {
  return list
    .map((item, i) => ({ item, r: Math.random() * (1 + i / 12) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, count)
    .map((x) => x.item);
}

/**
 * Orders a selection so the same artist never plays twice in a row when there is another choice,
 * and no artist takes more than `perArtist` places.
 */
export function spread(tracks: QueueItem[], limit: number, perArtist = 2): QueueItem[] {
  const pool = [...tracks];
  const out: QueueItem[] = [];
  const count = new Map<string, number>();
  while (out.length < limit && pool.length) {
    const last = out.length ? lead(out[out.length - 1].artist) : "";
    let at = pool.findIndex((t) => lead(t.artist) !== last && (count.get(lead(t.artist)) ?? 0) < perArtist);
    if (at < 0) at = pool.findIndex((t) => (count.get(lead(t.artist)) ?? 0) < perArtist);
    if (at < 0) break;
    const [track] = pool.splice(at, 1);
    out.push(track);
    count.set(lead(track.artist), (count.get(lead(track.artist)) ?? 0) + 1);
  }
  return out;
}

/**
 * "La música no se detiene": what plays after a song on its own, a search, a voice request, an album
 * or a playlist, 15 songs at a time. In order of trust:
 * 1. what the owner usually plays after this song or artist (their own history);
 * 2. YouTube Music's radio for the song (personal with their session), sampled differently each time
 *    and leaning to artists the owner already listens to;
 * 3. related artists (Aleatorio mágico's sources) and songs heard lately.
 * Never a song already in the queue (nor another version of it), and songs suggested in the last days
 * only when nothing new is left, so pressing "aleatorio" again really brings other songs.
 */
export async function continuationPicks(
  queue: QueueItem[],
  current: QueueItem | undefined,
  count = CONTINUE_BATCH,
  recent: () => Promise<QueueItem[]> = recentlyPlayed,
  avoid: QueueItem[] = [],
): Promise<QueueItem[]> {
  const used = new Set([...queue, ...avoid].map(songKey));
  // A JAM guest's song does not steer the radio: the last song the owner chose does.
  let seed = fromGuest(current) ? [...queue].reverse().find((t) => !fromGuest(t)) ?? current : current;
  // A Spotify song has no YouTube radio of its own: seed the radio with its YouTube twin.
  if (seed && !seed.videoId && seed.source === "spotify") {
    const twin = await youtubeTwin(seed).catch(() => undefined);
    if (twin) seed = { ...seed, videoId: twin.videoId };
  }
  const own = queue.filter((t) => !fromGuest(t));
  const [history, library] = await Promise.all([
    db.history.orderBy("at").reverse().limit(3000).toArray().catch(() => [] as HistoryEntry[]),
    db.tracks.toArray().catch(() => [] as QueueItem[]),
  ]);
  const byId = new Map(library.map((t) => [t.id, t]));
  const taste = judgeHistory(history, library).established;
  const lately = suggestedLately();
  const fresh = (t: QueueItem) => !lately.has(songKey(t));

  // 1. Habits: up to a third of the selection.
  const habits = seed ? habitsAfter(seed, history, byId).filter((h) => !used.has(songKey(h.track))) : [];
  const habitPicks = sampleLeaning(habits.map((h) => h.track), Math.ceil(count / 3));

  // 2. The song's radio, plus the radio of one of those habits for variety.
  const [first, second] = await Promise.all([radio(seed), radio(habitPicks[0])]);
  const radioPool = [...first, ...sampleLeaning(second, 12)].filter((t) => !used.has(songKey(t)));
  const liked = (t: QueueItem) => taste.has(lead(t.artist));
  // New songs first, those by artists the owner listens to a little ahead.
  const ranked = (list: QueueItem[]) => [
    ...sampleLeaning(list.filter((t) => fresh(t) && liked(t)), count),
    ...sampleLeaning(list.filter((t) => fresh(t) && !liked(t)), count),
  ];
  const picks: QueueItem[] = [];
  const add = (track: QueueItem) => {
    const key = songKey(track);
    if (used.has(key) || picks.length >= count * 2) return;
    used.add(key);
    picks.push(track);
  };
  habitPicks.forEach(add);
  // Mix the owner's artists and discoveries: about two of theirs for each new one.
  const mine = ranked(radioPool).filter(liked);
  const discover = ranked(radioPool).filter((t) => !liked(t));
  while ((mine.length || discover.length) && picks.length < count * 2) {
    if (mine.length) add(mine.shift()!);
    if (mine.length) add(mine.shift()!);
    if (discover.length) add(discover.shift()!);
  }
  // 3. Related artists and recent songs when the radio fell short.
  if (picks.length < count) (await magicPicks(own.slice(-12), seed, count).catch(() => [])).filter(fresh).forEach(add);
  if (picks.length < count) (await recent().catch(() => [])).filter(fresh).forEach(add);
  // Still short: songs already suggested lately are better than silence.
  if (picks.length < count) radioPool.forEach(add);
  const chosen = spread(picks, count, seed && taste.has(lead(seed.artist)) ? 3 : 2);
  rememberSuggested(chosen);
  return chosen.map((track) => ({ ...track, smart: true, continuation: true, userQueued: undefined, jamGuest: undefined }));
}

/** Songs heard for more than 30 s lately (not as a guest), newest first, one entry per song. */
export async function recentlyPlayed(limit = 40): Promise<QueueItem[]> {
  const entries = await db.history.orderBy("at").reverse().limit(400).toArray();
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.guest || entry.skipped || entry.seconds < 30 || ids.includes(entry.trackId)) continue;
    ids.push(entry.trackId);
    if (ids.length >= limit) break;
  }
  const tracks = (await db.tracks.bulkGet(ids)).filter((t): t is QueueItem => !!t && !t.deleted);
  // A light shuffle so the same order doesn't come back every time.
  return tracks.map((t, i) => ({ t, r: i + Math.random() * 8 })).sort((a, b) => a.r - b.r).map((x) => x.t);
}

/**
 * A block of songs for a mood, from your own YouTube Music Inicio for it (moodForYou), never one already in the queue. Each song carries the mood, so the presenter can name it.
 * `asked`: the listener asked for this mood, and the next blocks keep it.
 */
export async function moodPicks(mood: Mood, queue: QueueItem[], count: number, asked: boolean): Promise<QueueItem[]> {
  // Loaded on demand: the voice router depends on the player.
  const { moodForYou } = await import("./VoiceCommandRouter");
  const used = new Set(queue.map(songKey));
  const { tracks } = await moodForYou(mood).catch(() => ({ tracks: [] as QueueItem[] }));
  const out: QueueItem[] = [];
  for (const t of tracks) {
    const key = songKey(t);
    if (used.has(key) || out.length >= count) continue;
    used.add(key);
    out.push({ ...t, mood: mood.spoken, moodKey: mood.key, moodAsked: asked || undefined, continuation: true });
  }
  return out;
}
