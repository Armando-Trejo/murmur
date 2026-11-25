import { db } from "./db";
import { magicPicks } from "./magicShuffle";
import { songKey } from "./blendMixes";
import { youtubeTwin } from "./spotifyBridge";
import type { QueueItem } from "./types";
import type { Mood } from "./moods";

/** When this many songs or fewer remain after the current one, MURMUR adds more. */
export const CONTINUE_WHEN_LEFT = 2;
/** Songs added each time the queue is about to run out. */
export const CONTINUE_BATCH = 12;

/**
 * "La música no se detiene": what plays after the last song of a search, a voice request, an album
 * or a playlist. First YouTube Music's radio after the current song and artists related to the queue
 * (the same sources as Aleatorio mágico); if that falls short, songs you listened to recently.
 * Never a song already in the queue, including other versions of it (live, video, remaster…).
 */
export async function continuationPicks(
  queue: QueueItem[],
  current: QueueItem | undefined,
  count = CONTINUE_BATCH,
  recent: () => Promise<QueueItem[]> = recentlyPlayed,
): Promise<QueueItem[]> {
  const used = new Set(queue.map(songKey));
  // A Spotify song has no YouTube radio of its own: seed the radio with its YouTube twin.
  let seed = current;
  if (seed && !seed.videoId && seed.source === "spotify") {
    const twin = await youtubeTwin(seed).catch(() => undefined);
    if (twin) seed = { ...seed, videoId: twin.videoId };
  }
  const picks: QueueItem[] = [];
  const add = (track: QueueItem) => {
    const key = songKey(track);
    if (used.has(key) || picks.length >= count) return;
    used.add(key);
    picks.push(track);
  };
  // Related artists come from the latest songs, not from a long playlist's first ones.
  (await magicPicks(queue.slice(-12), seed, count).catch(() => [])).forEach(add);
  if (picks.length < count) (await recent().catch(() => [])).forEach(add);
  return picks.map((track) => ({ ...track, smart: true, continuation: true, userQueued: undefined }));
}

/** Songs heard for more than 30 s lately, newest first, one entry per song. */
export async function recentlyPlayed(limit = 40): Promise<QueueItem[]> {
  const entries = await db.history.orderBy("at").reverse().limit(400).toArray();
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.skipped || entry.seconds < 30 || ids.includes(entry.trackId)) continue;
    ids.push(entry.trackId);
    if (ids.length >= limit) break;
  }
  const tracks = (await db.tracks.bulkGet(ids)).filter((t): t is QueueItem => !!t);
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
