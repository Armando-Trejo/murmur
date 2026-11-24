import { Audio, isNative } from "../native";
import type { QueueItem } from "./types";

/** When each video was last warmed; a link stays useful for hours, so two minutes avoids repeats. */
const warmed = new Map<string, number>();
const COOLDOWN_MS = 120_000;

/**
 * Resolves the audio link of likely next taps (the row under the finger, the first search results,
 * the opening rows of a collection) so pressing play skips the resolver round trip.
 * Only the link is fetched, never audio bytes, and nothing happens with Data Saver on.
 */
export function prefetchAudio(tracks: (QueueItem | undefined)[], limit = 3, now = Date.now()) {
  if (!isNative) return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  const ids = tracks
    .flatMap((track) =>
      track?.source === "youtube" && !track.offlinePath && track.videoId &&
      now - (warmed.get(track.videoId) ?? 0) > COOLDOWN_MS ? [track.videoId] : [])
    .slice(0, limit);
  if (!ids.length) return;
  if (warmed.size > 400) warmed.clear();
  ids.forEach((id) => warmed.set(id, now));
  // Warming is best effort: an older native build or a preview bridge without the method is fine.
  try {
    void Audio.prefetchAudio({ videoIds: ids })?.catch(() => {});
  } catch {
    /* no native support */
  }
}
