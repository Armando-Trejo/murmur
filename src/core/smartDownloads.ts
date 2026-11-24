import { Audio, isNative } from "../native";
import { db } from "./db";
import { listeningStats } from "./musicOrder";
import { youtubeTwin } from "./spotifyBridge";
import type { QueueItem } from "./types";

/**
 * "Descargas inteligentes": your most played songs are kept on the phone so they play without
 * network, start instantly and cost no data again. Runs only on an unmetered network (Wi-Fi),
 * one song at a time; songs that leave your top are removed, but only the ones this feature
 * downloaded (manual downloads are never touched). Spotify songs use their YouTube Music twin.
 */
export const SMART_LIMIT = 30;
const ENABLED_KEY = "smartDownloads.enabled";
const OWNED_KEY = "smartDownloads.owned"; // trackId -> path, only what this feature downloaded

export async function smartDownloadsEnabled() {
  return ((await db.settings.get(ENABLED_KEY))?.value as boolean | undefined) ?? true;
}
export async function setSmartDownloads(value: boolean) {
  await db.settings.put({ key: ENABLED_KEY, value });
  if (!value) await clearSmartDownloads();
}

async function owned() {
  return ((await db.settings.get(OWNED_KEY))?.value as Record<string, string> | undefined) ?? {};
}

/** Removes everything this feature downloaded (turning it off frees the space). */
export async function clearSmartDownloads() {
  const files = await owned();
  for (const [trackId, path] of Object.entries(files)) {
    await Audio.deleteOfflineAudio({ path }).catch(() => {});
    const track = await db.tracks.get(trackId);
    if (track?.offlinePath === path) await db.tracks.update(trackId, { offlinePath: undefined });
  }
  await db.settings.put({ key: OWNED_KEY, value: {} });
}

/** The songs that deserve a local copy: most played, saved or not, at least 2 full listens. */
export function topSongs(tracks: QueueItem[], stats: ReturnType<typeof listeningStats>, limit = SMART_LIMIT) {
  return tracks
    .filter((t) => (stats[t.id]?.plays ?? 0) >= 2)
    .sort((a, b) => (stats[b.id]?.plays ?? 0) - (stats[a.id]?.plays ?? 0))
    .slice(0, limit);
}

let running = false;

export async function runSmartDownloads(onProgress?: (done: number, total: number) => void) {
  if (!isNative || running || !(await smartDownloadsEnabled())) return;
  running = true;
  try {
    const network = await Audio.networkState().catch(() => undefined);
    if (!network?.online || network.metered) return;
    const [tracks, history] = await Promise.all([db.tracks.toArray(), db.history.toArray()]);
    const top = topSongs(tracks, listeningStats(history));
    const files = await owned();
    const keep = new Set(top.map((t) => t.id));

    // Free the space of songs that left the top (only our own downloads).
    for (const [trackId, path] of Object.entries(files)) {
      if (keep.has(trackId)) continue;
      await Audio.deleteOfflineAudio({ path }).catch(() => {});
      const track = await db.tracks.get(trackId);
      if (track?.offlinePath === path) await db.tracks.update(trackId, { offlinePath: undefined });
      delete files[trackId];
    }

    const pending = top.filter((t) => !t.offlinePath);
    let done = 0;
    for (const track of pending) {
      // Stop as soon as the phone leaves Wi-Fi.
      const now = await Audio.networkState().catch(() => undefined);
      if (!now?.online || now.metered) break;
      const videoId = track.videoId ?? (track.source === "spotify" ? (await youtubeTwin(track).catch(() => undefined))?.videoId : undefined);
      if (!videoId) continue;
      try {
        const { path } = await Audio.downloadOfflineAudio({ videoId, fileName: track.title });
        await db.tracks.update(track.id, { offlinePath: path });
        files[track.id] = path;
        await db.settings.put({ key: OWNED_KEY, value: files });
        onProgress?.(++done, pending.length);
      } catch {
        /* One failed song does not stop the rest. */
      }
    }
    await db.settings.put({ key: OWNED_KEY, value: files });
  } finally {
    running = false;
  }
}
